import { describe, expect, it } from 'vitest';

import { AgentResponseFormatError, decodeAgentCommissionList } from './agent-decoders';

const LEDGER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const SNAPSHOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAB';
const ORDER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAC';
const ITEM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAD';
const PRODUCT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAE';
const SKU_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAF';

function ledgerItem(overrides: Record<string, unknown> = {}) {
  return {
    ledger_id: LEDGER_ID,
    commission_snapshot_id: SNAPSHOT_ID,
    order_id: ORDER_ID,
    order_no: 'SO-1001',
    customer_alias: '青序客户甲',
    order_item_id: ITEM_ID,
    product_id: PRODUCT_ID,
    product_name: '氨基酸洁面',
    sku_id: SKU_ID,
    sku_name: '120ml',
    effective_rate: '8.0000',
    commission_base: '99.00',
    original_commission: '7.92',
    refund_id: null,
    ledger_type: 'EXPECTED_CREATED',
    position_state: 'EXPECTED',
    expected_change: '7.92',
    available_change: '0.00',
    reason: '支付成功计入待结算',
    occurred_at: '2026-09-19T04:10:00.000Z',
    ...overrides,
  };
}

describe('decodeAgentCommissionList', () => {
  it('requires customer_alias and does not accept a phone number field', () => {
    const decoded = decodeAgentCommissionList({
      items: [ledgerItem()],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    expect(decoded.items[0]?.customer_alias).toBe('青序客户甲');

    expect(() => decodeAgentCommissionList({
      items: [ledgerItem({ customer_alias: undefined })],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).toThrow(AgentResponseFormatError);

    expect(() => decodeAgentCommissionList({
      items: [ledgerItem({ phone: '13800138000' })],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).toThrow(AgentResponseFormatError);
  });
});
