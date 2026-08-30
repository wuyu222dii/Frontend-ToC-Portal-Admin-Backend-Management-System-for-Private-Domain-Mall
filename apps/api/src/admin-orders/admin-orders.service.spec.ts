import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminFulfillmentAddressMaterial,
  AdminFulfillmentOrderDetail,
  AdminFulfillmentOrderListItem,
  DatabaseRuntime,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminOrdersService } from './admin-orders.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const FACTOR_ID = '01J00000000000000000000003';
const CUSTOMER_ID = '01J00000000000000000000004';
const ORDER_ID = '01J00000000000000000000005';
const ORDER_ITEM_ID = '01J00000000000000000000006';
const PRODUCT_ID = '01J00000000000000000000007';
const SKU_ID = '01J00000000000000000000008';
const SNAPSHOT_ID = '01J00000000000000000000009';
const SHIPMENT_ID = '01J0000000000000000000000A';
const SHIPMENT_ITEM_ID = '01J0000000000000000000000B';
const EVENT_ID = '01J0000000000000000000000C';
const REQUEST_ID = 'req_00000000000000000000000000000001';
const CREATED_AT = new Date('2026-08-30T01:00:00.000Z');
const UPDATED_AT = new Date('2026-08-30T02:00:00.000Z');
const PHONE = ['139', '0000', '6821'].join('');
const ADDRESS_DETAIL = ['Suite 5', ' 23 Queen Street'].join(',');
const RECIPIENT_NAME = ['Morgan', ' Reed'].join('');
const ACCESS_REASON = 'Dispatch handoff verification';
const FIELD_KEY = { id: 'field-current', key: Buffer.alloc(32, 41) };

const runtimeConfig = {
  encryption: {
    fieldKeys: { current: FIELD_KEY, previous: [] },
    idempotencyHashKeys: {
      current: { id: 'idempotency-current', key: Buffer.alloc(32, 42) },
      previous: [],
    },
    ipHashKey: Buffer.alloc(32, 43),
  },
} as unknown as PlatformRuntimeConfig;

function requestContext(
  withAddressPermission = true,
  role: 'AGENT_ADMIN' | 'CUSTOMER' | 'SUPER_ADMIN' = 'SUPER_ADMIN',
): AdminCatalogRequestContext {
  return {
    accessSession: {
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-08-30T04:00:00.000Z'),
      factorEncryptionKeyId: 'field-current',
      factorId: FACTOR_ID,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-30T00:30:00.000Z'),
      sessionFamily: '01J0000000000000000000000D',
      sessionId: SESSION_ID,
    },
    principal: {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: withAddressPermission ? ['ORDER_FULFILLMENT_PII_READ'] : [],
      restriction: 'NONE',
      role,
      sessionId: SESSION_ID,
    },
    requestId: REQUEST_ID,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function listItem(overrides: Partial<AdminFulfillmentOrderListItem> = {}): AdminFulfillmentOrderListItem {
  return {
    agentId: null,
    agentName: null,
    createdAt: CREATED_AT,
    customerAlias: 'customer_0004',
    customerId: CUSTOMER_ID,
    fulfillmentStatus: 'READY_TO_SHIP',
    orderId: ORDER_ID,
    orderNo: `QX${ORDER_ID}`,
    orderStatus: 'PENDING_SHIPMENT',
    paidAt: UPDATED_AT,
    payableAmount: '39.80',
    paymentResolution: 'NORMAL',
    paymentStatus: 'PAID',
    recipientPhoneMasked: '*** **** 6821',
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    version: 3,
    ...overrides,
  };
}

function detail(overrides: Partial<AdminFulfillmentOrderDetail> = {}): AdminFulfillmentOrderDetail {
  return {
    addressMasked: {
      detailMasked: 'Suite 5, ***',
      phoneMasked: '*** **** 6821',
      recipientNameMasked: 'M**',
      regionSummary: 'Auckland Auckland Central',
    },
    aftersales: [],
    attribution: { agentId: null, agentName: null, frozenAt: null, source: 'DIRECT' },
    commissionImpact: [],
    customer: {
      customerAlias: 'customer_0004',
      customerId: CUSTOMER_ID,
      nicknameMasked: 'M**',
      phoneMasked: '*** **** 6821',
    },
    eligibility: {
      activeAftersaleCount: 0,
      canAddLogisticsEvent: true,
      canComplete: false,
      canReadFulfillmentAddress: true,
      canShip: false,
      hasUnresolvedPayment: false,
    },
    inventoryImpact: [{
      availableChange: -2,
      onHandChange: -2,
      reasons: ['ORDER_PAID_DEDUCT'],
      reservedChange: -2,
      skuId: SKU_ID,
    }],
    order: {
      aftersaleExpiresAt: null,
      amounts: {
        goods: '39.80',
        paid: '39.80',
        payable: '39.80',
        refunded: '0.00',
        shipping: '0.00',
      },
      businessRuleVersionId: null,
      closeReason: null,
      closedAt: null,
      completedAt: null,
      completionReason: null,
      createdAt: CREATED_AT,
      customerId: CUSTOMER_ID,
      finalAgentId: null,
      finalChannel: 'DIRECT',
      fulfillmentStatus: 'IN_TRANSIT',
      items: [{
        brandName: 'Qingxu',
        categoryId: '01J0000000000000000000000E',
        categoryName: 'Personal care',
        createdAt: CREATED_AT,
        lineAmount: '39.80',
        orderItemId: ORDER_ITEM_ID,
        productId: PRODUCT_ID,
        productName: 'Daily wash',
        quantity: 2,
        refundedAmount: '0.00',
        refundedQuantity: 0,
        reservedAftersaleAmount: '0.00',
        reservedAftersaleQuantity: 0,
        shippedQuantity: 2,
        skuCode: 'SKU-001',
        skuId: SKU_ID,
        skuName: '500 ml',
        unitPrice: '19.90',
        version: 1,
      }],
      orderId: ORDER_ID,
      orderNo: `QX${ORDER_ID}`,
      orderStatus: 'SHIPPING',
      paidAt: UPDATED_AT,
      payExpiresAt: new Date('2026-08-30T01:30:00.000Z'),
      paymentResolution: 'NORMAL',
      paymentStatus: 'PAID',
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'NONE',
      source: 'CART',
      updatedAt: UPDATED_AT,
      version: 3,
    },
    paymentAttempts: [],
    refundAttempts: [],
    shipment: {
      carrierCode: 'MOCK',
      carrierName: 'Development carrier',
      createdAt: UPDATED_AT,
      deliveredAt: null,
      events: [{
        actorAccountId: ACCOUNT_ID,
        carrierCode: null,
        carrierName: null,
        createdAt: UPDATED_AT,
        description: 'Parcel accepted by carrier',
        eventId: EVENT_ID,
        eventKey: 'carrier-event-1',
        eventType: 'STATUS',
        location: 'Auckland',
        occurredAt: UPDATED_AT,
        reason: null,
        source: 'ADMIN',
        statusCode: 'IN_TRANSIT',
        trackingNo: null,
      }],
      items: [{
        orderItemId: ORDER_ITEM_ID,
        productName: 'Daily wash',
        quantity: 2,
        shipmentItemId: SHIPMENT_ITEM_ID,
        skuId: SKU_ID,
        skuName: '500 ml',
      }],
      orderId: ORDER_ID,
      shipmentId: SHIPMENT_ID,
      shippedAt: UPDATED_AT,
      status: 'IN_TRANSIT',
      trackingNo: 'DEV-TRACK-001',
      updatedAt: UPDATED_AT,
      version: 2,
    },
    ...overrides,
  };
}

function addressMaterial(
  overrides: Partial<AdminFulfillmentAddressMaterial> = {},
): AdminFulfillmentAddressMaterial {
  const protectedAddress = createStoreOrderAddressSecurityMaterial({
    detail: ADDRESS_DETAIL,
    phone: PHONE,
    snapshotId: SNAPSHOT_ID,
  }, FIELD_KEY);
  return {
    city: 'Auckland',
    detailCiphertext: protectedAddress.detailCiphertext,
    district: 'Central',
    eligibleForRead: true,
    encryptionKeyId: protectedAddress.encryptionKeyId,
    fulfillmentStatus: 'READY_TO_SHIP',
    orderId: ORDER_ID,
    orderNo: `QX${ORDER_ID}`,
    orderStatus: 'PENDING_SHIPMENT',
    paymentResolution: 'NORMAL',
    paymentStatus: 'PAID',
    phoneCiphertext: protectedAddress.phoneCiphertext,
    phoneLast4: protectedAddress.phoneLast4,
    province: 'Auckland',
    recipientName: RECIPIENT_NAME,
    snapshotAt: UPDATED_AT,
    snapshotId: SNAPSHOT_ID,
    ...overrides,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  fulfillment: {
    getAdminFulfillmentAddressMaterialInTransaction: ReturnType<typeof vi.fn>;
    getAdminOrderDetail: ReturnType<typeof vi.fn>;
    listAdminOrders: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  const transaction = {};
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
  };
  const database = { pool: {}, prisma } as unknown as DatabaseRuntime;
  const service = new AdminOrdersService(runtimeConfig, database);
  const mocks: ServiceInternals = {
    audit: { append: vi.fn().mockResolvedValue({}) },
    fulfillment: {
      getAdminFulfillmentAddressMaterialInTransaction: vi.fn().mockResolvedValue(addressMaterial()),
      getAdminOrderDetail: vi.fn().mockResolvedValue(detail()),
      listAdminOrders: vi.fn().mockResolvedValue({ items: [listItem()], total: 1 }),
    },
  };
  Object.assign(service as unknown as ServiceInternals, mocks);
  return { mocks, prisma, service, transaction };
}

function auditInputs(mock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return mock.mock.calls.map((call) => call[1] as Record<string, unknown>);
}

function expectAuditContainsNoSensitiveInput(mock: ReturnType<typeof vi.fn>): void {
  const serialized = JSON.stringify(auditInputs(mock));
  expect(serialized).not.toContain(ACCESS_REASON);
  expect(serialized).not.toContain(PHONE);
  expect(serialized).not.toContain(ADDRESS_DETAIL);
  expect(serialized).not.toContain(RECIPIENT_NAME);
}

describe('AdminOrdersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('returns list and detail projections without exposing full fulfillment PII', async () => {
    const { mocks, service } = harness();
    const query = { page: 1, pageSize: 20, sort: 'CREATED_DESC' as const };

    const list = await service.listOrders(query);
    const order = await service.getOrder(ORDER_ID);

    expect(mocks.fulfillment.listAdminOrders).toHaveBeenCalledWith(query);
    expect(mocks.fulfillment.getAdminOrderDetail).toHaveBeenCalledWith({ orderId: ORDER_ID });
    expect(list).toMatchObject({
      items: [{
        display_status: '待发货',
        recipient_phone_masked: '*** **** 6821',
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    expect(order).toMatchObject({
      available_actions: ['ADD_LOGISTICS_EVENT', 'READ_FULFILLMENT_ADDRESS'],
      display_status: '运输中',
      packages: [{
        events: [{ event_key: 'carrier-event-1', status_code: 'IN_TRANSIT' }],
        shipment_id: SHIPMENT_ID,
      }],
      shipping_address_masked: {
        detail_masked: 'Suite 5, ***',
        phone_masked: '*** **** 6821',
        recipient_name_masked: 'M**',
      },
    });
    const ordinaryProjection = JSON.stringify({ list, order });
    expect(ordinaryProjection).not.toContain(PHONE);
    expect(ordinaryProjection).not.toContain(ADDRESS_DETAIL);
    expect(ordinaryProjection).not.toContain(RECIPIENT_NAME);
    expect(ordinaryProjection).not.toContain('phoneCiphertext');
    expect(ordinaryProjection).not.toContain('detailCiphertext');
  });

  it('uses the complete shared status matrix for Admin list projections', async () => {
    const { mocks, service } = harness();
    mocks.fulfillment.listAdminOrders.mockResolvedValue({
      items: [listItem({
        fulfillmentStatus: 'CANCELLED',
        orderStatus: 'CLOSED',
        paymentResolution: 'MANUAL_REQUIRED',
      })],
      total: 1,
    });

    await expect(service.listOrders({ page: 1, pageSize: 20, sort: 'CREATED_DESC' }))
      .resolves.toMatchObject({ items: [{ display_status: '支付异常处理中' }] });
  });

  it('denies address access without the dedicated permission and persists a redacted failure audit', async () => {
    const { mocks, service } = harness();

    await expect(service.getFulfillmentAddress(
      requestContext(false), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    expect(mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction).not.toHaveBeenCalled();
    expect(mocks.audit.append).toHaveBeenCalledTimes(1);
    expect(auditInputs(mocks.audit.append)[0]).toMatchObject({
      action: 'READ_SENSITIVE',
      actorAccountId: ACCOUNT_ID,
      module: 'fulfillment',
      objectId: ORDER_ID,
      objectType: 'order',
      reason: expect.stringMatching(/^ORDER_FULFILLMENT:[a-f0-9]{64}$/),
      result: 'FAILURE',
      resultCode: 'PERMISSION_DENIED',
      summaryPolicy: 'NONE',
    });
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('audits and denies an AGENT_ADMIN even if its token carries the dedicated permission', async () => {
    const { mocks, service } = harness();

    await expect(service.getFulfillmentAddress(
      requestContext(true, 'AGENT_ADMIN'), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    expect(mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction).not.toHaveBeenCalled();
    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({
        actorRole: 'AGENT_ADMIN',
        result: 'FAILURE',
        resultCode: 'PERMISSION_DENIED',
      }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it.each([
    ['invalid purpose', 'ORDER_REVIEW', ACCESS_REASON],
    ['invalid reason', 'ORDER_FULFILLMENT', 'bad'],
  ])('rejects %s before reading encrypted material and audits the failure', async (_label, purpose, reason) => {
    const { mocks, service } = harness();

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, purpose, reason,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    expect(mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction).not.toHaveBeenCalled();
    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({ result: 'FAILURE', resultCode: 'INVALID_ARGUMENT' }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('fails closed on an ineligible order state and persists a failure audit', async () => {
    const { mocks, service } = harness();
    mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction.mockResolvedValue(
      addressMaterial({ eligibleForRead: false, fulfillmentStatus: 'DELIVERED', orderStatus: 'COMPLETED' }),
    );

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({ result: 'FAILURE', resultCode: 'STATE_CONFLICT' }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('preserves not-found semantics while auditing the failed controlled read', async () => {
    const { mocks, service } = harness();
    mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction.mockRejectedValue(
      new ApplicationError('RESOURCE_NOT_FOUND', 'Order not found'),
    );

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({ result: 'FAILURE', resultCode: 'RESOURCE_NOT_FOUND' }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('AAD-verifies the encrypted snapshot and audits success without raw reason or PII', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T03:00:00.000Z'));
    const { mocks, service, transaction } = harness();

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).resolves.toEqual({
      access_expires_at: '2026-08-30T03:05:00.000Z',
      city: 'Auckland',
      detail: ADDRESS_DETAIL,
      district: 'Central',
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      phone: PHONE,
      province: 'Auckland',
      purpose: 'ORDER_FULFILLMENT',
      recipient_name: RECIPIENT_NAME,
      snapshot_at: UPDATED_AT.toISOString(),
      snapshot_id: SNAPSHOT_ID,
    });

    expect(mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction)
      .toHaveBeenCalledWith(transaction, { orderId: ORDER_ID });
    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({
        reason: expect.stringMatching(/^ORDER_FULFILLMENT:[a-f0-9]{64}$/),
        result: 'SUCCESS',
        resultCode: 'OK',
      }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('rejects tampered address ciphertext as an internal failure and writes only a redacted audit', async () => {
    const { mocks, service } = harness();
    const material = addressMaterial();
    const tampered = Buffer.from(material.detailCiphertext);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction.mockResolvedValue({
      ...material,
      detailCiphertext: tampered,
    });

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({ result: 'FAILURE', resultCode: 'INTERNAL_ERROR' }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('fails closed when the success audit cannot be committed and records the resulting failure', async () => {
    const { mocks, service } = harness();
    mocks.audit.append
      .mockRejectedValueOnce(new Error('audit write unavailable'))
      .mockResolvedValueOnce({});

    await expect(service.getFulfillmentAddress(
      requestContext(), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    expect(auditInputs(mocks.audit.append)).toEqual([
      expect.objectContaining({ result: 'SUCCESS', resultCode: 'OK' }),
      expect.objectContaining({ result: 'FAILURE', resultCode: 'INTERNAL_ERROR' }),
    ]);
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });

  it('replaces a denied read with a safe internal error when its failure audit cannot persist', async () => {
    const { mocks, service } = harness();
    mocks.audit.append.mockRejectedValue(new Error('audit write unavailable'));

    await expect(service.getFulfillmentAddress(
      requestContext(false), ORDER_ID, 'ORDER_FULFILLMENT', ACCESS_REASON,
    )).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });

    expect(mocks.fulfillment.getAdminFulfillmentAddressMaterialInTransaction).not.toHaveBeenCalled();
    expectAuditContainsNoSensitiveInput(mocks.audit.append);
  });
});
