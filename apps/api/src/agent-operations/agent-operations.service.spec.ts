import type { AgentOrderDetailSnapshot, CurrentAgentSession } from '@qingxu/database';
import { describe, expect, it, vi } from 'vitest';

import { AgentOperationsService } from './agent-operations.service';

const session = {
  accountId: '01J00000000000000000000000',
  agentId: '01J00000000000000000000001',
  agentName: 'North Agent',
  restriction: 'NONE',
} as CurrentAgentSession;

function detail(): AgentOrderDetailSnapshot {
  const at = new Date('2026-09-03T08:00:00.000Z');
  return {
    addressSummaryMasked: 'Auckland',
    aftersales: [],
    closeReason: null,
    commissionItems: [{
      effectiveRate: '5.0000',
      orderItemId: '01J00000000000000000000004',
      originalCommission: '1.00',
      ruleSource: 'PLATFORM',
      state: 'EXPECTED',
    }],
    completionReason: null,
    createdAt: at,
    customerAlias: 'customer_payment_snapshot',
    customerCity: 'Auckland',
    customerId: '01J00000000000000000000003',
    customerNicknameMasked: 'P**',
    customerPhoneTail: '4826',
    finalAgentId: session.agentId,
    fulfillmentStatus: 'READY_TO_SHIP',
    items: [{
      lineAmount: '20.00',
      orderItemId: '01J00000000000000000000004',
      productId: '01J00000000000000000000005',
      productName: 'Frozen Product',
      quantity: 1,
      refundedQuantity: 0,
      reservedAftersaleQuantity: 0,
      shippedQuantity: 0,
      skuId: '01J00000000000000000000006',
      skuName: 'Frozen SKU',
      unitPrice: '20.00',
    }],
    orderId: '01J00000000000000000000002',
    orderNo: 'QX-AGENT-ORDER',
    orderStatus: 'PENDING_SHIPMENT',
    paidAt: at,
    payableAmount: '20.00',
    paymentResolution: 'NORMAL',
    paymentStatus: 'PAID',
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    timeline: [{
      axis: 'PAYMENT',
      eventCode: 'PAYMENT_SUCCEEDED',
      eventId: 'payment-event',
      fromStatus: null,
      occurredAt: at,
      toStatus: 'PAID',
    }],
  };
}

describe('AgentOperationsService', () => {
  it('maps only payment-time privacy and frozen region into Agent order detail', async () => {
    const getOrder = vi.fn().mockResolvedValue(detail());
    const service = new AgentOperationsService();
    (service as unknown as { operations: { getOrder: typeof getOrder } }).operations = { getOrder };

    const result = await service.getOrder(session, '01J00000000000000000000002');

    expect(getOrder).toHaveBeenCalledWith({
      accountId: session.accountId,
      agentId: session.agentId,
      orderId: '01J00000000000000000000002',
    });
    expect(result.customer_snapshot).toEqual({
      address_summary_masked: 'Auckland',
      city: 'Auckland',
      customer_alias: 'customer_payment_snapshot',
      nickname_masked: 'P**',
      phone_tail: '4826',
    });
    expect(result).not.toHaveProperty('customer_id');
    expect(result.customer_snapshot).not.toHaveProperty('recipient_name');
    expect(result.customer_snapshot).not.toHaveProperty('phone');
  });
});
