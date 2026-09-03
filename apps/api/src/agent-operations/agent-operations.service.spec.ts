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
      commissionSnapshotId: '01J00000000000000000000007',
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
    expect(result.commission_items).toEqual([expect.objectContaining({
      commission_snapshot_id: '01J00000000000000000000007',
    })]);
  });

  it('maps immutable commission ledger and explanation facts without consulting current rules', async () => {
    const occurredAt = new Date('2026-09-03T08:00:00.000Z');
    const snapshot = {
      categoryId: '01J00000000000000000000007',
      categoryName: 'Frozen Category',
      commissionBase: '20.00',
      commissionSnapshotId: '01J00000000000000000000008',
      effectiveRate: '5.0000',
      expectedRemaining: '1.00',
      hitPath: ['RULE_VERSION:01J00000000000000000000009', 'PLATFORM'],
      ledger: [{
        availableChange: '0.00',
        expectedChange: '1.00',
        frozenChange: '0.00',
        ledgerId: '01J00000000000000000000010',
        ledgerType: 'EXPECTED_CREATED' as const,
        occurredAt,
        reason: 'ORDER_PAID',
        refundId: null,
      }],
      orderId: '01J00000000000000000000002',
      orderItemId: '01J00000000000000000000004',
      orderNo: 'QX-AGENT-ORDER',
      originalCommission: '1.00',
      positionState: 'EXPECTED' as const,
      productId: '01J00000000000000000000005',
      productName: 'Frozen Product',
      reversalTotal: '0.00',
      ruleSource: 'PLATFORM' as const,
      ruleVersionId: '01J00000000000000000000009',
      ruleVersionNo: 3,
      skuId: '01J00000000000000000000006',
      skuName: 'Frozen SKU',
    };
    const getCommission = vi.fn().mockResolvedValue(snapshot);
    const listCommissions = vi.fn().mockResolvedValue({
      items: [{
        availableChange: '0.00',
        commissionBase: snapshot.commissionBase,
        commissionSnapshotId: snapshot.commissionSnapshotId,
        effectiveRate: snapshot.effectiveRate,
        expectedChange: '1.00',
        ledgerId: snapshot.ledger[0]!.ledgerId,
        ledgerType: 'EXPECTED_CREATED',
        occurredAt,
        orderId: snapshot.orderId,
        orderItemId: snapshot.orderItemId,
        orderNo: snapshot.orderNo,
        originalCommission: snapshot.originalCommission,
        positionState: snapshot.positionState,
        productId: snapshot.productId,
        productName: snapshot.productName,
        reason: 'ORDER_PAID',
        refundId: null,
        skuId: snapshot.skuId,
        skuName: snapshot.skuName,
      }],
      total: 1,
    });
    const service = new AgentOperationsService();
    (service as unknown as { operations: { getCommission: typeof getCommission; listCommissions: typeof listCommissions } })
      .operations = { getCommission, listCommissions };

    await expect(service.listCommissions(session, { page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [{
        commission_base: '20.00',
        commission_snapshot_id: snapshot.commissionSnapshotId,
        effective_rate: '5.0000',
        product_name: 'Frozen Product',
        refund_id: null,
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    await expect(service.getCommission(session, snapshot.commissionSnapshotId)).resolves.toMatchObject({
      item: {
        category_name: 'Frozen Category',
        hit_path: snapshot.hitPath,
        ledger: [{ occurred_at: occurredAt.toISOString(), refund_id: null }],
        rounding_mode: 'HALF_UP',
        rounding_scale: 2,
        rule_version_no: 3,
      },
      order_id: snapshot.orderId,
    });
    expect(getCommission).toHaveBeenCalledWith({
      accountId: session.accountId,
      agentId: session.agentId,
      commissionSnapshotId: snapshot.commissionSnapshotId,
    });
  });

  it('maps the reconciled wallet and Shanghai dashboard projections', async () => {
    const asOf = new Date('2026-09-03T08:00:00.000Z');
    const getDashboard = vi.fn().mockResolvedValue({
      agentId: session.agentId,
      asOf,
      attributedCustomerCount: 2,
      availableBalance: '-1.00',
      commissionExceptionCount: 0,
      expectedCommission: '3.00',
      frozenBalance: '2.00',
      monthNetSalesAmount: '19.00',
      negativeBalance: '1.00',
      pendingWithdrawalCount: 1,
      todayNetSalesAmount: '9.00',
      todayPaidOrderCount: 1,
      trend: [{
        businessDate: '2026-09-03',
        commissionChange: '1.00',
        netSalesAmount: '9.00',
        paidOrderCount: 1,
      }],
      withdrawalActionCount: 0,
    });
    const getWallet = vi.fn().mockResolvedValue({
      availableBalance: '-1.00',
      blockedReason: 'NEGATIVE_BALANCE',
      expectedCommission: '3.00',
      frozenBalance: '2.00',
      isNegative: true,
      negativeBalance: '1.00',
      version: 4,
      withdrawalAllowed: false,
    });
    const service = new AgentOperationsService();
    (service as unknown as { operations: { getDashboard: typeof getDashboard; getWallet: typeof getWallet } })
      .operations = { getDashboard, getWallet };

    await expect(service.getDashboard(session)).resolves.toMatchObject({
      agent_id: session.agentId,
      as_of: asOf.toISOString(),
      timezone: 'Asia/Shanghai',
      today_net_sales_amount: '9.00',
      trend: [{ business_date: '2026-09-03' }],
    });
    await expect(service.getWallet(session)).resolves.toEqual({
      available_balance: '-1.00',
      blocked_reason: 'NEGATIVE_BALANCE',
      frozen_balance: '2.00',
      is_negative: true,
      version: 4,
      withdrawal_allowed: false,
    });
  });
});
