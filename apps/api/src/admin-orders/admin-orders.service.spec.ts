import { createHmac } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminFulfillmentAddressMaterial,
  AdminFulfillmentOrderDetail,
  AdminFulfillmentOrderListItem,
  DatabaseRuntime,
  FulfillmentShipmentProjection,
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
const CREATE_SHIPMENT_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const APPEND_EVENT_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000002';
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

function shipment(
  overrides: Partial<FulfillmentShipmentProjection> = {},
): FulfillmentShipmentProjection {
  const projection = detail().shipment;
  if (projection === null) throw new Error('Shipment fixture is unavailable');
  return { ...projection, ...overrides };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  completion: { completeAdmin: ReturnType<typeof vi.fn> };
  fulfillment: {
    appendLogisticsEventInTransaction: ReturnType<typeof vi.fn>;
    createShipmentInTransaction: ReturnType<typeof vi.fn>;
    getAdminFulfillmentAddressMaterialInTransaction: ReturnType<typeof vi.fn>;
    getAdminOrderDetail: ReturnType<typeof vi.fn>;
    getAdminShipmentInTransaction: ReturnType<typeof vi.fn>;
    listAdminOrders: ReturnType<typeof vi.fn>;
  };
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
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
    completion: { completeAdmin: vi.fn().mockResolvedValue({}) },
    fulfillment: {
      appendLogisticsEventInTransaction: vi.fn(),
      createShipmentInTransaction: vi.fn(),
      getAdminFulfillmentAddressMaterialInTransaction: vi.fn().mockResolvedValue(addressMaterial()),
      getAdminOrderDetail: vi.fn().mockResolvedValue(detail()),
      getAdminShipmentInTransaction: vi.fn().mockResolvedValue(shipment()),
      listAdminOrders: vi.fn().mockResolvedValue({ items: [listItem()], total: 1 }),
    },
    idempotency: {
      assertHashOnlyReplay: vi.fn(),
      claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
      complete: vi.fn().mockResolvedValue({}),
    },
    outbox: { append: vi.fn().mockResolvedValue({}) },
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

  it('completes through the shared transaction service and returns the exact Admin command projection', async () => {
    const { mocks, service } = harness();
    const completed = detail();
    mocks.fulfillment.getAdminOrderDetail.mockResolvedValue(detail({
      order: {
        ...completed.order,
        completedAt: UPDATED_AT,
        completionReason: 'ADMIN_FORCED',
        fulfillmentStatus: 'DELIVERED',
        orderStatus: 'COMPLETED',
        version: 4,
      },
      shipment: completed.shipment === null ? null : {
        ...completed.shipment,
        deliveredAt: UPDATED_AT,
        status: 'DELIVERED',
        version: 3,
      },
    }));

    const result = await service.completeOrder(
      requestContext(),
      ORDER_ID,
      { completionReason: 'ADMIN_FORCED', reason: 'Delivery verified by administrator' },
      3,
      CREATE_SHIPMENT_IDEMPOTENCY_KEY,
    );

    expect(Object.keys(result).sort()).toEqual([
      'address_snapshot',
      'aftersale_ids',
      'amounts',
      'close_reason',
      'completion_reason',
      'customer_id',
      'display_status',
      'fulfillment_status',
      'items',
      'order_id',
      'order_no',
      'order_status',
      'payment_attempts',
      'payment_resolution',
      'payment_status',
      'refund_processing_status',
      'refund_progress_status',
      'version',
    ]);
    expect(result).toMatchObject({
      completion_reason: 'ADMIN_FORCED',
      display_status: '已完成',
      fulfillment_status: 'DELIVERED',
      order_id: ORDER_ID,
      order_status: 'COMPLETED',
      version: 4,
    });
    expect(result).not.toHaveProperty('available_actions');
    expect(result).not.toHaveProperty('packages');
    expect(result).not.toHaveProperty('shipping_address_masked');

    expect(mocks.completion.completeAdmin).toHaveBeenCalledWith({
      actorAccountId: ACCOUNT_ID,
      expectedOrderVersion: 3,
      idempotencyKey: CREATE_SHIPMENT_IDEMPOTENCY_KEY,
      ipAddress: '127.0.0.1',
      orderId: ORDER_ID,
      reason: 'Delivery verified by administrator',
      requestId: REQUEST_ID,
    });
    expect(mocks.fulfillment.getAdminOrderDetail).toHaveBeenCalledWith({ orderId: ORDER_ID });
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

  it('creates a shipment with HASH_ONLY completion, minimal audit and RESOURCE_EVENT_V1 outbox', async () => {
    const { mocks, service, transaction } = harness();
    const created = shipment({ events: [], status: 'SHIPPED', version: 1 });
    mocks.fulfillment.createShipmentInTransaction.mockResolvedValue({
      kind: 'created',
      orderVersion: 4,
      shipment: created,
    });
    const input = {
      carrierCode: 'MOCK',
      carrierName: 'Development carrier',
      items: [{ orderItemId: ORDER_ITEM_ID, quantity: 2 }],
      trackingNo: 'DEV-TRACK-001',
    };

    await expect(service.createShipment(
      requestContext(), ORDER_ID, input, 3, CREATE_SHIPMENT_IDEMPOTENCY_KEY,
    )).resolves.toEqual({
      carrier_code: 'MOCK',
      carrier_name: 'Development carrier',
      delivered_at: null,
      items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
      order_id: ORDER_ID,
      shipment_id: SHIPMENT_ID,
      shipped_at: UPDATED_AT.toISOString(),
      status: 'SHIPPED',
      tracking_no: 'DEV-TRACK-001',
      version: 1,
    });

    expect(mocks.idempotency.claim).toHaveBeenCalledWith(transaction, {
      actorId: ACCOUNT_ID,
      idempotencyKey: CREATE_SHIPMENT_IDEMPOTENCY_KEY,
      request: {
        body: {
          carrier_code: 'MOCK',
          carrier_name: 'Development carrier',
          expected_version: 3,
          items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
          tracking_no: 'DEV-TRACK-001',
        },
        method: 'POST',
        pathParameters: { order_id: ORDER_ID },
        route: '/admin/orders/{order_id}/shipments',
      },
    });
    expect(mocks.fulfillment.createShipmentInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        actorAccountId: ACCOUNT_ID,
        carrierCode: 'MOCK',
        carrierName: 'Development carrier',
        expectedOrderVersion: 3,
        orderId: ORDER_ID,
        shipmentId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        trackingNo: 'DEV-TRACK-001',
      }),
    );
    const command = mocks.fulfillment.createShipmentInTransaction.mock.calls[0]?.[1] as {
      items: Array<{ orderItemId: string; quantity: number; shipmentItemId: string }>;
    };
    expect(command.items).toEqual([{
      orderItemId: ORDER_ITEM_ID,
      quantity: 2,
      shipmentItemId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    }]);
    expect(mocks.audit.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'CREATE',
      actorAccountId: ACCOUNT_ID,
      after: { status: 'SHIPPED', version: 1 },
      idempotencyKey: CREATE_SHIPMENT_IDEMPOTENCY_KEY,
      module: 'fulfillment',
      objectId: SHIPMENT_ID,
      objectType: 'shipment',
      requestId: REQUEST_ID,
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(mocks.outbox.append).toHaveBeenCalledWith(transaction, {
      aggregateId: SHIPMENT_ID,
      aggregateType: 'shipment',
      eventType: 'shipment.created',
      payload: {
        event_version: 1,
        resource_id: SHIPMENT_ID,
        resource_type: 'shipment',
        resource_version: 1,
      },
    });
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ idempotencyKey: CREATE_SHIPMENT_IDEMPOTENCY_KEY }),
      {
        resourceId: SHIPMENT_ID,
        responseForHash: { shipment_created: { order_id: ORDER_ID, shipment_id: SHIPMENT_ID } },
        responseStatus: 201,
        storage: 'HASH_ONLY',
      },
    );
    const persistedMetadata = JSON.stringify([
      mocks.audit.append.mock.calls,
      mocks.outbox.append.mock.calls,
      mocks.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    expect(persistedMetadata).not.toContain('DEV-TRACK-001');
    expect(persistedMetadata).not.toContain('Development carrier');
  });

  it('replays shipment creation from the current order-scoped projection before any business write', async () => {
    const { mocks, service, transaction } = harness();
    const record = { resource_id: SHIPMENT_ID, response_body: null, response_status: 201 };
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record });
    mocks.fulfillment.getAdminShipmentInTransaction.mockResolvedValue(
      shipment({ status: 'IN_TRANSIT', version: 2 }),
    );

    await expect(service.createShipment(
      requestContext(),
      ORDER_ID,
      {
        carrierCode: 'MOCK',
        carrierName: 'Development carrier',
        items: [{ orderItemId: ORDER_ITEM_ID, quantity: 2 }],
        trackingNo: 'DEV-TRACK-001',
      },
      3,
      CREATE_SHIPMENT_IDEMPOTENCY_KEY,
    )).resolves.toMatchObject({ shipment_id: SHIPMENT_ID, status: 'IN_TRANSIT', version: 2 });

    expect(mocks.fulfillment.getAdminShipmentInTransaction).toHaveBeenCalledWith(transaction, {
      orderId: ORDER_ID,
      shipmentId: SHIPMENT_ID,
    });
    expect(mocks.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: SHIPMENT_ID,
      responseForHash: { shipment_created: { order_id: ORDER_ID, shipment_id: SHIPMENT_ID } },
      responseStatus: 201,
      storage: 'HASH_ONLY',
    });
    expect(mocks.fulfillment.createShipmentInTransaction).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('fails the shipment transaction before outbox and idempotency completion when audit persistence fails', async () => {
    const { mocks, service } = harness();
    mocks.fulfillment.createShipmentInTransaction.mockResolvedValue({
      kind: 'created',
      orderVersion: 4,
      shipment: shipment({ events: [], status: 'SHIPPED', version: 1 }),
    });
    mocks.audit.append.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.createShipment(
      requestContext(),
      ORDER_ID,
      {
        carrierCode: 'MOCK',
        carrierName: 'Development carrier',
        items: [{ orderItemId: ORDER_ITEM_ID, quantity: 2 }],
        trackingNo: 'DEV-TRACK-001',
      },
      3,
      CREATE_SHIPMENT_IDEMPOTENCY_KEY,
    )).rejects.toThrow('audit unavailable');

    expect(mocks.fulfillment.createShipmentInTransaction).toHaveBeenCalledOnce();
    expect(mocks.audit.append).toHaveBeenCalledOnce();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
  });

  it('appends a tracking correction with a stable HMAC key and redacted persistence metadata', async () => {
    const { mocks, service, transaction } = harness();
    const correctionReason = 'Operator corrected a copied tracking reference';
    const corrected = shipment({
      carrierCode: 'NEW',
      carrierName: 'New carrier',
      events: [{
        actorAccountId: ACCOUNT_ID,
        carrierCode: 'NEW',
        carrierName: 'New carrier',
        createdAt: UPDATED_AT,
        description: 'Tracking reference corrected',
        eventId: EVENT_ID,
        eventKey: 'evt_fixture',
        eventType: 'TRACKING_CORRECTION',
        location: null,
        occurredAt: UPDATED_AT,
        reason: correctionReason,
        source: 'ADMIN',
        statusCode: null,
        trackingNo: 'DEV-TRACK-002',
      }],
      trackingNo: 'DEV-TRACK-002',
      version: 3,
    });
    mocks.fulfillment.appendLogisticsEventInTransaction.mockResolvedValue({
      event: corrected.events[0],
      kind: 'applied',
      shipment: corrected,
    });
    const input = {
      carrierCode: 'NEW',
      carrierName: 'New carrier',
      description: 'Tracking reference corrected',
      eventType: 'TRACKING_CORRECTION' as const,
      location: null,
      occurredAt: UPDATED_AT.toISOString(),
      reason: correctionReason,
      trackingNo: 'DEV-TRACK-002',
    };

    await expect(service.appendLogisticsEvent(
      requestContext(), SHIPMENT_ID, input, 2, APPEND_EVENT_IDEMPOTENCY_KEY,
    )).resolves.toMatchObject({
      events: [{ event_type: 'TRACKING_CORRECTION', reason: correctionReason }],
      shipment: { shipment_id: SHIPMENT_ID, tracking_no: 'DEV-TRACK-002', version: 3 },
    });

    const eventCommand = mocks.fulfillment.appendLogisticsEventInTransaction.mock.calls[0]?.[1] as {
      event: { occurredAt: Date; reason: string };
      eventId: string;
      eventKey: string;
    };
    const expectedEventKey = `evt_${createHmac('sha256', Buffer.alloc(32, 42))
      .update('qingxu:fulfillment-logistics-event:v1\0', 'utf8')
      .update(JSON.stringify([ACCOUNT_ID, SHIPMENT_ID, APPEND_EVENT_IDEMPOTENCY_KEY]), 'utf8')
      .digest('hex')}`;
    expect(eventCommand).toMatchObject({
      event: { occurredAt: UPDATED_AT, reason: correctionReason },
      eventId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      eventKey: expectedEventKey,
    });
    expect(mocks.audit.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'UPDATE',
      after: { status: 'IN_TRANSIT', version: 3 },
      before: { status: 'IN_TRANSIT', version: 2 },
      objectId: SHIPMENT_ID,
      reason: expect.stringMatching(/^TRACKING_CORRECTION:[a-f0-9]{64}$/),
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(mocks.outbox.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      aggregateId: SHIPMENT_ID,
      eventType: 'shipment.updated',
      payload: expect.objectContaining({ resource_version: 3 }),
    }));
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ idempotencyKey: APPEND_EVENT_IDEMPOTENCY_KEY }),
      {
        resourceId: SHIPMENT_ID,
        responseForHash: { logistics_event_appended: { shipment_id: SHIPMENT_ID } },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      },
    );
    const persistedMetadata = JSON.stringify([
      mocks.audit.append.mock.calls,
      mocks.outbox.append.mock.calls,
      mocks.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    expect(persistedMetadata).not.toContain(correctionReason);
    expect(persistedMetadata).not.toContain('DEV-TRACK-002');
    expect(persistedMetadata).not.toContain('Tracking reference corrected');
  });

  it('replays a logistics event as the current shipment projection without appending another event', async () => {
    const { mocks, service, transaction } = harness();
    const record = { resource_id: SHIPMENT_ID, response_body: null, response_status: 200 };
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record });
    mocks.fulfillment.getAdminShipmentInTransaction.mockResolvedValue(shipment({ version: 4 }));

    await expect(service.appendLogisticsEvent(
      requestContext(),
      SHIPMENT_ID,
      {
        description: 'Parcel delivered',
        eventType: 'STATUS',
        location: 'Auckland',
        occurredAt: UPDATED_AT.toISOString(),
        statusCode: 'DELIVERED',
      },
      3,
      APPEND_EVENT_IDEMPOTENCY_KEY,
    )).resolves.toMatchObject({ shipment: { shipment_id: SHIPMENT_ID, version: 4 } });

    expect(mocks.fulfillment.getAdminShipmentInTransaction).toHaveBeenCalledWith(transaction, {
      shipmentId: SHIPMENT_ID,
    });
    expect(mocks.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: SHIPMENT_ID,
      responseForHash: { logistics_event_appended: { shipment_id: SHIPMENT_ID } },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(mocks.fulfillment.appendLogisticsEventInTransaction).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
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
