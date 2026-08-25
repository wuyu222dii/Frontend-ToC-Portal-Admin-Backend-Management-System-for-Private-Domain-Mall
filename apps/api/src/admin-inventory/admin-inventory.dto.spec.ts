import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseInventoryAdjustmentBody,
  parseInventoryAdjustmentConfirmationBody,
  parseInventoryLedgerQuery,
  parseInventoryListQuery,
  parseInventorySkuId,
  type InventoryLedgerType,
} from './admin-inventory.dto';

const skuId = '01J00000000000000000000000';
const categoryId = '01J00000000000000000000001';
const confirmationHash = 'a'.repeat(64);
const previewToken = `pvw_${'b'.repeat(43)}`;

const ledgerTypes: readonly InventoryLedgerType[] = [
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
];

describe('admin inventory request DTOs', () => {
  it('parses list defaults and an unbounded nonblank keyword', () => {
    expect(parseInventoryListQuery({})).toEqual({ page: 1, pageSize: 20 });
    const keyword = 'I'.repeat(500);
    expect(parseInventoryListQuery({
      category_id: categoryId,
      keyword,
      page: '2',
      page_size: '100',
    })).toEqual({ categoryId, keyword, page: 2, pageSize: 100 });
  });

  it.each([
    -2_147_483_648,
    -1,
    1,
    2_147_483_647,
  ])('accepts the non-zero int32 physical delta %s', (physicalDelta) => {
    expect(parseInventoryAdjustmentBody({ physical_delta: physicalDelta, reason: 'Approved count' }))
      .toEqual({ physicalDelta, reason: 'Approved count' });
  });

  it('parses the closed confirmation capability fields', () => {
    expect(parseInventoryAdjustmentConfirmationBody({
      confirmation_hash: confirmationHash,
      physical_delta: 5,
      preview_token: previewToken,
      reason: 'Approved count correction',
    })).toEqual({
      confirmationHash,
      physicalDelta: 5,
      previewToken,
      reason: 'Approved count correction',
    });
  });

  it.each(ledgerTypes)('accepts the closed ledger type %s', (ledgerType) => {
    expect(parseInventoryLedgerQuery({ ledger_type: ledgerType }))
      .toEqual({ ledgerType, page: 1, pageSize: 20 });
  });

  it('converts Asia/Shanghai natural dates into a UTC half-open interval', () => {
    expect(parseInventoryLedgerQuery({
      date_from: '2026-08-25',
      date_to: '2026-08-26',
      page: '3',
      page_size: '50',
    })).toEqual({
      occurredAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      occurredAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      page: 3,
      pageSize: 50,
    });
  });

  it('accepts a real leap day independently of the process timezone', () => {
    expect(parseInventoryLedgerQuery({ date_from: '2024-02-29', date_to: '2024-02-29' }))
      .toEqual({
        occurredAtFrom: new Date('2024-02-28T16:00:00.000Z'),
        occurredAtToExclusive: new Date('2024-02-29T16:00:00.000Z'),
        page: 1,
        pageSize: 20,
      });
  });

  it('parses the SKU path identity', () => {
    expect(parseInventorySkuId(skuId)).toBe(skuId);
  });

  it.each([
    () => parseInventoryListQuery({ keyword: '' }),
    () => parseInventoryListQuery({ keyword: '   ' }),
    () => parseInventoryListQuery({ category_id: 'category' }),
    () => parseInventoryListQuery({ page: '0' }),
    () => parseInventoryListQuery({ page_size: '101' }),
    () => parseInventoryListQuery({ low_stock: 'true' }),
    () => parseInventoryAdjustmentBody({ physical_delta: 0, reason: 'Approved count' }),
    () => parseInventoryAdjustmentBody({ physical_delta: 1.5, reason: 'Approved count' }),
    () => parseInventoryAdjustmentBody({ physical_delta: -2_147_483_649, reason: 'Approved count' }),
    () => parseInventoryAdjustmentBody({ physical_delta: 2_147_483_648, reason: 'Approved count' }),
    () => parseInventoryAdjustmentBody({ physical_delta: 1, reason: 'x' }),
    () => parseInventoryAdjustmentBody({ physical_delta: 1, reason: 'x'.repeat(501) }),
    () => parseInventoryAdjustmentBody({ physical_delta: 1, reason: 'Approved', note: 'not allowed' }),
    () => parseInventoryAdjustmentConfirmationBody({
      confirmation_hash: confirmationHash,
      physical_delta: 1,
      preview_token: 'x'.repeat(15),
      reason: 'Approved count',
    }),
    () => parseInventoryAdjustmentConfirmationBody({
      confirmation_hash: confirmationHash,
      physical_delta: 1,
      preview_token: 'x'.repeat(513),
      reason: 'Approved count',
    }),
    () => parseInventoryAdjustmentConfirmationBody({
      confirmation_hash: 'A'.repeat(64),
      physical_delta: 1,
      preview_token: previewToken,
      reason: 'Approved count',
    }),
    () => parseInventoryAdjustmentConfirmationBody({
      confirmation_hash: confirmationHash,
      physical_delta: 1,
      preview_token: previewToken,
      reason: 'Approved count',
      status: 'SUCCEEDED',
    }),
    () => parseInventoryLedgerQuery({ ledger_type: 'MANUAL_ADJUST' }),
    () => parseInventoryLedgerQuery({ date_from: '2026-02-29' }),
    () => parseInventoryLedgerQuery({ date_to: '2026-04-31' }),
    () => parseInventoryLedgerQuery({ date_from: '2026-08-26', date_to: '2026-08-25' }),
    () => parseInventoryLedgerQuery({ date_from: '25-08-2026' }),
    () => parseInventoryLedgerQuery({ timezone: 'Pacific/Auckland' }),
    () => parseInventorySkuId('../sku'),
  ])('rejects open or contract-invalid inventory input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });
});
